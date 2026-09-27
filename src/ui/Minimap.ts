import type { MapImage } from './mapPainter';

/** Everything the minimap shows, in world meters (x east, z south). */
export interface MinimapFrame {
  /** Viewer position and yaw (0 = facing -z / north). */
  x: number;
  z: number;
  yaw: number;
  zones: { id: string; x: number; z: number; r: number; owner: 'ally' | 'enemy' | null; contested: boolean }[];
  allies: { x: number; z: number; squad: boolean }[];
  enemies: { x: number; z: number }[];
}

/** Meters from the centre to the edge of the minimap. */
const RANGE = 85;
const COLORS = {
  ally: '#4aa3ff',
  squad: '#6fe08a',
  enemy: '#ff5a4f',
  neutral: '#e8e8e0',
};

/**
 * Round, heading-up minimap (like BF): the map image turns around the player,
 * who stays in the centre pointing up. Zones outside the range stick to the
 * rim so they can still be found.
 */
export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private size = 0;
  private time = 0;
  private sinceDraw = Infinity;

  constructor(
    parent: HTMLElement,
    private readonly image: MapImage,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
  }

  setVisible(on: boolean): void {
    this.canvas.style.display = on ? '' : 'none';
  }

  draw(f: MinimapFrame, dt: number): void {
    this.time += dt;
    // 30 redraws a second is plenty for a map.
    this.sinceDraw += dt;
    if (this.sinceDraw < 1 / 30) return;
    this.sinceDraw = 0;
    const css = this.canvas.clientWidth;
    if (css === 0) return;
    const px = Math.round(css * Math.min(2, window.devicePixelRatio || 1));
    if (px !== this.size) {
      this.size = px;
      this.canvas.width = this.canvas.height = px;
    }
    const g = this.g;
    const S = this.size;
    const R = S / 2;
    const k = R / RANGE; // canvas px per meter
    const cos = Math.cos(f.yaw);
    const sin = Math.sin(f.yaw);
    /** World point -> minimap pixels (heading up). */
    const at = (x: number, z: number): [number, number] => {
      const dx = x - f.x;
      const dz = z - f.z;
      // Rotate by +yaw (see mapPainter: north-up image, map yaw turns the view).
      return [R + (dx * cos - dz * sin) * k, R + (dx * sin + dz * cos) * k];
    };

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(R, R, R - 1, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#1b211d';
    g.fillRect(0, 0, S, S);

    // Map image, rotated around the player.
    const [u, v] = this.image.project(f.x, f.z);
    const m = k / this.image.scale;
    g.translate(R, R);
    g.rotate(f.yaw);
    g.scale(m, m);
    g.translate(-u, -v);
    g.globalAlpha = 0.9;
    g.drawImage(this.image.canvas, 0, 0);
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);

    // Zones: rings in range, markers clamped to the rim beyond it.
    const blink = Math.sin(this.time * 8) > 0;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${Math.round(S * 0.075)}px system-ui, sans-serif`;
    for (const z of f.zones) {
      const color = z.contested && blink ? '#ffb347' : z.owner ? COLORS[z.owner] : COLORS.neutral;
      let [zx, zy] = at(z.x, z.z);
      const off = Math.hypot(zx - R, zy - R);
      const edge = R - S * 0.07;
      if (off > edge) {
        zx = R + ((zx - R) / off) * edge;
        zy = R + ((zy - R) / off) * edge;
      } else {
        g.beginPath();
        g.arc(zx, zy, Math.max(4, z.r * k), 0, Math.PI * 2);
        g.strokeStyle = color;
        g.lineWidth = Math.max(1.5, S * 0.008);
        g.globalAlpha = 0.8;
        g.stroke();
        g.globalAlpha = 1;
      }
      g.fillStyle = 'rgba(0, 0, 0, 0.55)';
      g.beginPath();
      g.arc(zx, zy, S * 0.05, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = color;
      g.fillText(z.id, zx, zy + 1);
    }

    const dot = (x: number, z: number, color: string, r: number) => {
      const [a, b] = at(x, z);
      if (Math.hypot(a - R, b - R) > R) return;
      g.beginPath();
      g.arc(a, b, r, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      g.stroke();
    };
    for (const a of f.allies) dot(a.x, a.z, a.squad ? COLORS.squad : COLORS.ally, S * 0.02);
    for (const e of f.enemies) dot(e.x, e.z, COLORS.enemy, S * 0.022);

    // The player: an arrow pointing up.
    const s = S * 0.045;
    g.beginPath();
    g.moveTo(R, R - s);
    g.lineTo(R + s * 0.7, R + s * 0.75);
    g.lineTo(R, R + s * 0.35);
    g.lineTo(R - s * 0.7, R + s * 0.75);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
    g.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    g.lineWidth = 1.5;
    g.stroke();
    g.restore();

    // Rim and a north tick.
    g.beginPath();
    g.arc(R, R, R - 1.5, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(230, 232, 228, 0.55)';
    g.lineWidth = 2;
    g.stroke();
    const north = at(f.x, f.z - RANGE);
    const na = Math.atan2(north[1] - R, north[0] - R);
    g.fillStyle = '#e8e8e0';
    g.font = `700 ${Math.round(S * 0.07)}px system-ui, sans-serif`;
    g.fillText('N', R + Math.cos(na) * (R - S * 0.06), R + Math.sin(na) * (R - S * 0.06));
  }
}
