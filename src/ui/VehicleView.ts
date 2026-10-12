/**
 * The first-person view from a vehicle seat (owner, 2026-10-12: "remake every
 * vehicle's first-person camera, after Battlefield V"), drawn on one 2D
 * canvas over the game:
 *
 * - `sight` (a closed seat working a cannon: tanks, the APC's autocannon, the
 *   rocket truck): from inside the turret, a periscope's dark metal frame
 *   with the reticle in the middle; zoomed (aim button), the round scope with
 *   a range ladder. A reload ring round the reticle, the hull / turret
 *   compass and the hull's health at the bottom.
 * - `mg` (a closed machine-gun seat): a ring sight and the barrel heat.
 * - `port` (a closed seat without a gun: the APC driver, passengers): a
 *   vision block, the world through a wide slit.
 * - `cockpit` (a pilot): the canopy frame, a reflector gunsight with the
 *   horizon through it, and the instruments along the bottom (speed,
 *   altitude, throttle, heading).
 * - `open` (jeep, bike, open gun seats): nothing over the view; the vehicle
 *   itself is in sight.
 */

export type VehicleViewKind = 'sight' | 'mg' | 'port' | 'cockpit' | 'open';

export interface VehicleViewState {
  kind: VehicleViewKind;
  /** Zoom now (1 = none). */
  zoom: number;
  /** Shell guns: share of the reload left (0 = loaded). */
  reload: number;
  /** Machine guns: barrel heat 0..1, and cooling off after overheating. */
  heat: number;
  overheated: boolean;
  /** The vehicle's health 0..1. */
  health: number;
  /** The hull's heading against the view (rad, 0 = straight ahead, + = to the right). */
  hullYaw: number;
  /** Where the look is against the gun (rad: yaw + = left, pitch + = up), while the gun is still turning there. */
  aimYaw: number;
  aimPitch: number;
  /** Distance to what the reticle is on (m), or null. */
  range: number | null;
  /** The gun lobs its rounds (howitzer, rockets): ranges count. */
  lobbed: boolean;
  /** Aircraft: attitude (rad), heading (rad, 0 = north / -z), speed (km/h), height over the ground (m), throttle 0..1. */
  pitch: number;
  roll: number;
  heading: number;
  speed: number;
  alt: number;
  throttle: number;
  locked: boolean;
  /** A warning over the sight (aircraft: turning back at the edge of the air space). */
  warning: string | null;
  /** Vertical field of view (deg), for the horizon's place. */
  fovY: number;
  /** Words shown: the gun's name, the vehicle's, the zoom and range labels. */
  gunName: string;
  vehicleName: string;
}

const INK = 'rgba(232, 228, 205, 0.92)';
const INK_DIM = 'rgba(232, 228, 205, 0.45)';
const DARK = 'rgba(6, 8, 10, 0.94)';
const HUD = 'rgba(120, 255, 190, 0.9)';
const WARN = 'rgba(255, 96, 72, 0.95)';

export class VehicleView {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private kind: VehicleViewKind | null = null;
  private w = 0;
  private h = 0;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vehicle-view';
    parent.prepend(this.canvas);
    this.g = this.canvas.getContext('2d')!;
  }

  /** Draws `s` (null: hidden). */
  update(s: VehicleViewState | null): void {
    if (!s || s.kind === 'open') {
      if (this.kind !== null) {
        this.canvas.style.display = 'none';
        this.kind = null;
      }
      return;
    }
    if (this.kind === null) this.canvas.style.display = 'block';
    this.kind = s.kind;
    // Device pixels 1:1 with CSS pixels: crisp enough for lines, cheap to clear.
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w !== this.w || h !== this.h) {
      this.w = this.canvas.width = w;
      this.h = this.canvas.height = h;
    }
    const g = this.g;
    g.clearRect(0, 0, w, h);
    if (s.kind === 'sight') this.sight(s);
    else if (s.kind === 'mg') this.mg(s);
    else if (s.kind === 'port') this.port(s);
    else this.cockpit(s);
  }

  // ---------------------------------------------------------------------------

  private text(t: string, x: number, y: number, size: number, color = INK, align: CanvasTextAlign = 'center'): void {
    const g = this.g;
    g.font = `600 ${Math.round(size)}px Bahnschrift, 'DIN Alternate', 'Malgun Gothic', sans-serif`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillText(t, x + 1, y + 1);
    g.fillStyle = color;
    g.fillText(t, x, y);
  }

  /** Inside the turret, looking out through the periscope: dark frame, bolts and a bevel round a wide window. */
  private periscope(win: { x: number; y: number; w: number; h: number }): void {
    const g = this.g;
    const { w, h } = this;
    g.fillStyle = DARK;
    g.beginPath();
    g.rect(0, 0, w, h);
    const r = Math.min(win.w, win.h) * 0.08;
    g.roundRect(win.x, win.y, win.w, win.h, r);
    g.fill('evenodd');
    // The window's bevel and the glass's tint at its edges.
    g.strokeStyle = 'rgba(70, 76, 70, 0.9)';
    g.lineWidth = Math.max(3, h * 0.006);
    g.beginPath();
    g.roundRect(win.x, win.y, win.w, win.h, r);
    g.stroke();
    const edge = g.createLinearGradient(0, win.y, 0, win.y + win.h);
    edge.addColorStop(0, 'rgba(20, 30, 28, 0.35)');
    edge.addColorStop(0.18, 'rgba(20, 30, 28, 0)');
    edge.addColorStop(0.82, 'rgba(20, 30, 28, 0)');
    edge.addColorStop(1, 'rgba(20, 30, 28, 0.4)');
    g.fillStyle = edge;
    g.fillRect(win.x, win.y, win.w, win.h);
    // Bolts on the frame.
    g.fillStyle = 'rgba(90, 96, 88, 0.9)';
    const bolt = Math.max(2, h * 0.006);
    for (const fx of [0.12, 0.37, 0.63, 0.88]) {
      for (const by of [win.y - h * 0.035, win.y + win.h + h * 0.035]) {
        g.beginPath();
        g.arc(win.x + win.w * fx, by, bolt, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  private sight(s: VehicleViewState): void {
    const g = this.g;
    const { w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    const zoomed = s.zoom > 1.4;
    const u = Math.min(w, h);
    if (zoomed) {
      // The scope: a round field with a dark surround and a soft edge.
      const r = u * 0.42;
      const grad = g.createRadialGradient(cx, cy, r * 0.94, cx, cy, r * 1.04);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, DARK);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.fillStyle = DARK;
      g.beginPath();
      g.rect(0, 0, w, h);
      g.arc(cx, cy, r * 1.04, 0, Math.PI * 2);
      g.fill('evenodd');
      // Reticle: the aiming chevron, broken cross lines, a range ladder under the chevron.
      g.strokeStyle = INK;
      g.lineWidth = Math.max(1.5, u * 0.0022);
      g.beginPath();
      g.moveTo(cx - r * 0.95, cy);
      g.lineTo(cx - r * 0.08, cy);
      g.moveTo(cx + r * 0.08, cy);
      g.lineTo(cx + r * 0.95, cy);
      g.moveTo(cx, cy + r * 0.5);
      g.lineTo(cx, cy + r * 0.95);
      g.stroke();
      this.chevron(cx, cy, r * 0.06);
      for (let i = 1; i <= 4; i++) {
        const y = cy + r * 0.09 * i;
        const half = r * (0.05 - i * 0.006);
        g.beginPath();
        g.moveTo(cx - half, y);
        g.lineTo(cx + half, y);
        g.stroke();
        this.text(String(i * 2), cx + half + r * 0.03, y, u * 0.014, INK_DIM, 'left');
      }
      // Side ticks (lead) along the cross line.
      for (let i = 1; i <= 6; i++) {
        for (const sx of [-1, 1]) {
          const x = cx + sx * r * 0.13 * i;
          g.beginPath();
          g.moveTo(x, cy - r * 0.02);
          g.lineTo(x, cy + r * 0.02);
          g.stroke();
        }
      }
      this.text(`×${s.zoom.toFixed(0)}`, cx + r * 0.72, cy - r * 0.72, u * 0.022);
      this.reloadRing(cx, cy, r * 0.2, s.reload);
      if (s.range !== null) this.text(`${String(Math.round(s.range)).padStart(4, '0')} m`, cx + r * 0.62, cy + r * 0.78, u * 0.02);
    } else {
      // Unzoomed: the periscope's wide window, a small chevron in it.
      this.periscope({ x: w * 0.06, y: h * 0.16, w: w * 0.88, h: h * 0.62 });
      g.strokeStyle = INK;
      g.lineWidth = Math.max(1.5, u * 0.002);
      this.chevron(cx, cy, u * 0.018);
      g.beginPath();
      g.moveTo(cx - u * 0.06, cy);
      g.lineTo(cx - u * 0.03, cy);
      g.moveTo(cx + u * 0.03, cy);
      g.lineTo(cx + u * 0.06, cy);
      g.stroke();
      this.reloadRing(cx, cy, u * 0.04, s.reload);
      if (s.range !== null) this.text(`${Math.round(s.range)} m`, cx + u * 0.075, cy + u * 0.03, u * 0.016, INK_DIM, 'left');
    }
    if (s.lobbed) this.text(s.gunName, cx, h * 0.12, u * 0.02, INK_DIM);
    // Where the gun is turning to: a small open circle the reticle catches up with.
    if (Math.abs(s.aimYaw) + Math.abs(s.aimPitch) > 0.004) {
      const k = h / 2 / Math.tan(((s.fovY * Math.PI) / 180) / 2);
      const ax = cx - Math.tan(s.aimYaw) * k;
      const ay = cy - Math.tan(s.aimPitch) * k;
      g.strokeStyle = INK_DIM;
      g.lineWidth = Math.max(1.5, u * 0.002);
      g.beginPath();
      g.arc(Math.max(0, Math.min(w, ax)), Math.max(0, Math.min(h, ay)), u * 0.012, 0, Math.PI * 2);
      g.stroke();
    }
    this.panel(s);
  }

  /** The aiming chevron (an inverted V, its point on the aim). */
  private chevron(x: number, y: number, size: number): void {
    const g = this.g;
    g.beginPath();
    g.moveTo(x - size, y + size * 0.9);
    g.lineTo(x, y);
    g.lineTo(x + size, y + size * 0.9);
    g.stroke();
  }

  /** The reload as a ring that closes up as the next round goes in. */
  private reloadRing(x: number, y: number, r: number, left: number): void {
    const g = this.g;
    g.lineWidth = Math.max(2, r * 0.08);
    if (left > 0.001) {
      g.strokeStyle = INK_DIM;
      g.beginPath();
      g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - left));
      g.stroke();
    } else {
      g.strokeStyle = 'rgba(232, 228, 205, 0.18)';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
    }
  }

  private mg(s: VehicleViewState): void {
    const g = this.g;
    const { w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    const u = Math.min(w, h);
    // A ring sight seen down the barrel, the hull's dark inside round it.
    const r = u * (s.zoom > 1.2 ? 0.46 : 0.38);
    const grad = g.createRadialGradient(cx, cy, r * 0.82, cx, cy, r * 1.15);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(6, 8, 10, 0.88)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = s.overheated ? WARN : INK;
    g.lineWidth = Math.max(1.5, u * 0.0022);
    g.beginPath();
    g.arc(cx, cy, u * 0.06, 0, Math.PI * 2);
    g.moveTo(cx + u * 0.12, cy);
    g.arc(cx, cy, u * 0.12, 0, Math.PI * 2);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      g.moveTo(cx + dx * u * 0.12, cy + dy * u * 0.12);
      g.lineTo(cx + dx * u * 0.15, cy + dy * u * 0.15);
    }
    g.stroke();
    g.fillStyle = s.overheated ? WARN : INK;
    g.beginPath();
    g.arc(cx, cy, Math.max(1.5, u * 0.003), 0, Math.PI * 2);
    g.fill();
    // Heat: a bar under the sight.
    const bw = u * 0.18;
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(cx - bw / 2, cy + u * 0.2, bw, u * 0.008);
    g.fillStyle = s.overheated ? WARN : INK;
    g.fillRect(cx - bw / 2, cy + u * 0.2, bw * Math.min(1, s.heat), u * 0.008);
    this.panel(s);
  }

  private port(s: VehicleViewState): void {
    const { w, h } = this;
    // A vision block: a wide, low slit.
    this.periscope({ x: w * 0.1, y: h * 0.3, w: w * 0.8, h: h * 0.3 });
    this.text(s.vehicleName, w / 2, h * 0.72, Math.min(w, h) * 0.02, INK_DIM);
    this.panel(s);
  }

  /** Bottom middle: the hull's outline turned against the view (the turret points up), and its health. */
  private panel(s: VehicleViewState): void {
    const g = this.g;
    const { w, h } = this;
    const u = Math.min(w, h);
    const x = w / 2;
    const y = h - u * 0.1;
    const size = u * 0.035;
    g.save();
    g.translate(x, y);
    // Hull.
    g.save();
    g.rotate(s.hullYaw);
    g.strokeStyle = s.health < 0.3 ? WARN : INK;
    g.lineWidth = Math.max(1.5, u * 0.0025);
    g.strokeRect(-size * 0.55, -size, size * 1.1, size * 2);
    // Its front: a notch.
    g.beginPath();
    g.moveTo(-size * 0.3, -size);
    g.lineTo(0, -size * 1.25);
    g.lineTo(size * 0.3, -size);
    g.stroke();
    g.restore();
    // Turret / the view: straight up.
    g.strokeStyle = INK;
    g.beginPath();
    g.arc(0, 0, size * 0.35, 0, Math.PI * 2);
    g.moveTo(0, -size * 0.35);
    g.lineTo(0, -size * 1.6);
    g.stroke();
    g.restore();
    // Health bar beside it.
    const bw = u * 0.14;
    const bx = x + size * 2;
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(bx, y - u * 0.005, bw, u * 0.01);
    g.fillStyle = s.health < 0.3 ? WARN : INK;
    g.fillRect(bx, y - u * 0.005, bw * Math.max(0, Math.min(1, s.health)), u * 0.01);
    this.text(`${Math.round(s.health * 100)}`, bx + bw + u * 0.025, y, u * 0.018);
    this.text(s.vehicleName, bx, y - u * 0.025, u * 0.015, INK_DIM, 'left');
  }

  private cockpit(s: VehicleViewState): void {
    const g = this.g;
    const { w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    const u = Math.min(w, h);
    // The canopy: a bow frame across the top, two pillars, the sill along the bottom.
    g.fillStyle = 'rgba(18, 22, 26, 0.96)';
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w, 0);
    g.lineTo(w, h * 0.06);
    g.quadraticCurveTo(cx, h * 0.17, 0, h * 0.06);
    g.closePath();
    g.fill();
    for (const side of [-1, 1]) {
      g.beginPath();
      const x0 = cx + side * w * 0.5;
      g.moveTo(x0, h * 0.04);
      g.lineTo(cx + side * w * 0.36, h * 0.12);
      g.lineTo(cx + side * w * 0.31, h * 0.84);
      g.lineTo(x0, h * 0.92);
      g.closePath();
      g.fill();
    }
    // The coaming with the instruments.
    g.beginPath();
    g.moveTo(0, h);
    g.lineTo(0, h * 0.84);
    g.quadraticCurveTo(cx, h * 0.78, w, h * 0.84);
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    // The reflector sight: a ring and a dot on the glass, the horizon through it.
    const pxPerRad = h / 2 / Math.tan(((s.fovY * Math.PI) / 180) / 2);
    g.save();
    g.translate(cx, cy);
    g.rotate(-s.roll);
    const hy = s.pitch * pxPerRad;
    g.strokeStyle = 'rgba(120, 255, 190, 0.35)';
    g.lineWidth = Math.max(1, u * 0.0016);
    g.beginPath();
    g.moveTo(-u * 0.3, hy);
    g.lineTo(-u * 0.08, hy);
    g.moveTo(u * 0.08, hy);
    g.lineTo(u * 0.3, hy);
    g.stroke();
    g.restore();
    g.strokeStyle = s.locked ? WARN : HUD;
    g.lineWidth = Math.max(1.5, u * 0.0022);
    g.beginPath();
    g.arc(cx, cy, u * 0.075, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r0 = u * (i % 3 === 0 ? 0.062 : 0.068);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * u * 0.075, cy + Math.sin(a) * u * 0.075);
      g.stroke();
    }
    g.fillStyle = s.locked ? WARN : HUD;
    g.beginPath();
    g.arc(cx, cy, Math.max(1.5, u * 0.004), 0, Math.PI * 2);
    g.fill();
    if (s.locked) this.text('LOCK', cx, cy - u * 0.1, u * 0.02, WARN);
    if (s.warning) this.text(s.warning, cx, cy + u * 0.12, u * 0.018, WARN);
    // Instruments: speed, altitude, throttle, heading.
    const iy = h * 0.92;
    const dial = (x: number, label: string, value: string) => {
      g.strokeStyle = 'rgba(200, 205, 190, 0.6)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, iy, u * 0.045, 0, Math.PI * 2);
      g.stroke();
      this.text(value, x, iy - u * 0.006, u * 0.02);
      this.text(label, x, iy + u * 0.022, u * 0.011, INK_DIM);
    };
    dial(cx - u * 0.33, 'KM/H', String(Math.round(s.speed)));
    dial(cx - u * 0.11, 'M', String(Math.round(s.alt)));
    const deg = ((((s.heading * 180) / Math.PI) % 360) + 360) % 360;
    dial(cx + u * 0.11, 'HDG', String(Math.round(deg)).padStart(3, '0'));
    // Throttle: a short upright bar.
    const tx = cx + u * 0.31;
    const th = u * 0.09;
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(tx, iy - th / 2, u * 0.016, th);
    g.fillStyle = HUD;
    g.fillRect(tx, iy + th / 2 - th * s.throttle, u * 0.016, th * s.throttle);
    this.text('THR', tx + u * 0.008, iy + th / 2 + u * 0.016, u * 0.011, INK_DIM);
    // Hull health: a bar along the bottom edge of the glass.
    const bw = u * 0.3;
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(cx - bw / 2, h * 0.815, bw, u * 0.007);
    g.fillStyle = s.health < 0.3 ? WARN : HUD;
    g.fillRect(cx - bw / 2, h * 0.815, bw * Math.max(0, Math.min(1, s.health)), u * 0.007);
  }
}
