// src/ui/MinimapUI.js
// Patch 8-1D: Circular, rotating minimap (player-centered) + zones + walls
// - Canvas 2D overlay (lightweight)
// - Circular clip
// - Rotation follows player yaw (player faces "up")

export class MinimapUI {
  constructor(canvas, opts = {}) {
    if (!canvas) throw new Error("MinimapUI: canvas is required");
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    this.size = { w: canvas.width, h: canvas.height };
    this.pad = opts.padding ?? 10; // px

    this.uiScale = Number.isFinite(opts.uiScale) ? Number(opts.uiScale) : 1.0; // scale UI sizes

    // Patch 8-1D options
    this.circular = (opts.circular ?? true);
    this.rotateMap = (opts.rotateMap ?? false); // map rotates around player
    this.rotateWithPlayer = this.rotateMap;

    // If range is not provided, we auto-derive from bounds (full-map-ish).
    this._autoRange = !Number.isFinite(opts.range);
    this.range = Number.isFinite(opts.range) ? Number(opts.range) : 50; // world units (meters-like)

    // World bounds in XZ (used for auto range)
    this.bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };

    this.player = { x: 0, z: 0, yawRad: 0, team: "BLUE" };
    this.zones = []; // {id,x,z,owner,progress}
    this.walls = []; // axis-aligned boxes: { x,z,w,d }
    // Patch 8-3A: bot/actor markers on minimap
    this.markers = []; // {x,z,team,type}
  }

  setBounds(bounds) {
    if (!bounds) return;
    this.bounds = { ...this.bounds, ...bounds };
    if (this._autoRange) {
      const w = Math.abs((this.bounds.maxX - this.bounds.minX) || 100);
      const d = Math.abs((this.bounds.maxZ - this.bounds.minZ) || 100);
      // Make range roughly "half of the larger side" so outer wall is usually visible.
      this.range = this._clamp(Math.max(w, d) * 0.35, 22, 65);
    }
  }

  // Convenience: map.world.groundSize = [w,d] centered at (0,0)
  setBoundsFromGroundSize(groundSize) {
    const w = Number(groundSize?.[0] ?? groundSize?.width ?? 100) || 100;
    const d = Number(groundSize?.[1] ?? groundSize?.depth ?? 100) || 100;
    this.setBounds({ minX: -w / 2, maxX: w / 2, minZ: -d / 2, maxZ: d / 2 });
  }

  setZones(zones) {
    this.zones = (zones || []).map((z) => {
      const pos = z.pos ?? z.position ?? [0, 0, 0];
      return {
        id: z.id ?? "?",
        x: Number(pos[0] ?? pos.x ?? 0) || 0,
        z: Number(pos[2] ?? pos.z ?? 0) || 0,
        owner: z.owner ?? "NEUTRAL",
        progress: z.progress ?? 0,
        radius: Number(z.radius ?? z.r ?? z.captureRadius ?? 0) || 0,
      };
    });
  }

  setWalls(objects) {
    // Extract axis-aligned wall rectangles from map objects.
    // Expected: { type:'wall', shape:'box', pos:[x,y,z], size:[w,h,d] }
    const arr = Array.isArray(objects) ? objects : [];
    this.walls = arr
      .filter((o) => o && o.type === "wall" && (o.shape === "box" || !o.shape))
      .map((o) => {
        const pos = o.pos ?? o.position ?? [0, 0, 0];
        const size = o.size ?? o.scale ?? [1, 1, 1];
        return {
          x: Number(pos[0] ?? pos.x ?? 0) || 0,
          z: Number(pos[2] ?? pos.z ?? 0) || 0,
          w: Math.abs(Number(size[0] ?? size.x ?? 1) || 1),
          d: Math.abs(Number(size[2] ?? size.z ?? 1) || 1),
        };
      });
  }

  // Patch 8-3A
  setMarkers(markers){
    const arr = Array.isArray(markers) ? markers : [];
    this.markers = arr.map(m => ({
      x: Number(m?.x ?? 0) || 0,
      z: Number(m?.z ?? 0) || 0,
      team: String(m?.team ?? "").toLowerCase() || "",
      type: String(m?.type ?? "marker")
    }));
  }

  updatePlayer({ x, z, yawRad, team }) {
    if (Number.isFinite(x)) this.player.x = x;
    if (Number.isFinite(z)) this.player.z = z;
    if (Number.isFinite(yawRad)) this.player.yawRad = yawRad;
    if (team) this.player.team = team;
  }

  updateZoneStates(zoneStates) {
    if (!zoneStates) return;
    const byId = new Map(zoneStates.map((s) => [String(s.id), s]));
    for (const z of this.zones) {
      const s = byId.get(String(z.id));
      if (!s) continue;
      if (s.owner) z.owner = s.owner;
      if (Number.isFinite(s.progress)) z.progress = s.progress;
    }
  }

  _clamp(v, lo, hi) {
    const n = Number(v);
    if (!Number.isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
  }

  // World delta (dx,dz) -> minimap pixel delta (px,py) relative to center.
  _deltaToPixel(dx, dz) {
    const { w, h } = this.size;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) - 1;
    const innerR = Math.max(8, radius - this.pad);
    const scale = innerR / (this.range || 1);

    // rotate with player so player always faces up
    let rx = dx;
    let rz = dz;
    if (this.rotateWithPlayer) {
      const yaw = this.player.yawRad || 0;
      const c = Math.cos(-yaw);
      const s = Math.sin(-yaw);
      rx = dx * c - dz * s;
      rz = dx * s + dz * c;
    }

    // +Z should be "up" on minimap => screen y decreases with +Z
    const px = rx * scale;
    const py = -rz * scale;

    return { cx, cy, innerR, px, py };
  }

  _withinRange(dx, dz) {
    const r = this.range || 1;
    return (dx * dx + dz * dz) <= (r * r * 1.25); // slight slack so edges don't pop
  }

  draw() {
    const ctx = this.ctx;
    const { w, h } = this.size;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) - 1;
    const innerR = Math.max(8, radius - this.pad);
    const scale = innerR / (this.range || 1);

    // clear
    ctx.clearRect(0, 0, w, h);

    // background (circle)
    ctx.save();
    if (this.circular) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, w, h);

    // subtle grid ring
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.stroke();

    // Draw walls (outline) as rotated polygons
    if (this.walls && this.walls.length) {
      ctx.strokeStyle = "rgba(255,255,255,0.24)";
      ctx.lineWidth = 1;
      for (const wall of this.walls) {
        const dx = wall.x - this.player.x;
        const dz = wall.z - this.player.z;
        // Skip far walls for performance; for big outer walls, they'll show when in range.
        if (!this._withinRange(dx, dz) && (wall.w < this.range * 0.6 && wall.d < this.range * 0.6)) continue;

        const hx = wall.w / 2;
        const hz = wall.d / 2;

        // corners relative to player
        const corners = [
          { x: dx - hx, z: dz - hz },
          { x: dx + hx, z: dz - hz },
          { x: dx + hx, z: dz + hz },
          { x: dx - hx, z: dz + hz },
        ];

        ctx.beginPath();
        for (let i = 0; i < corners.length; i++) {
          const c = corners[i];
          const t = this._deltaToPixel(c.x, c.z);
          const x = t.cx + t.px;
          const y = t.cy + t.py;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }

    // Zones
    for (const z of this.zones) {
      const dx = z.x - this.player.x;
      const dz = z.z - this.player.z;
      if (!this._withinRange(dx, dz)) continue;
      const t = this._deltaToPixel(dx, dz);
      const u = t.cx + t.px;
      const v = t.cy + t.py;

      // zone radius ring (scaled from world radius)
      const zr = Number.isFinite(z.radius) && z.radius > 0 ? z.radius : 6;
      const pr = Math.max(6, Math.min(innerR - 2, zr * scale));

      let stroke = "rgba(220,220,220,0.55)"; // neutral
      let fill = "rgba(180,180,180,0.14)";
      if (z.owner === "BLUE") { stroke = "rgba(80,170,255,0.85)"; fill = "rgba(80,170,255,0.18)"; }
      if (z.owner === "RED")  { stroke = "rgba(255,90,90,0.85)"; fill = "rgba(255,90,90,0.18)"; }

      // radius area
      ctx.beginPath();
      ctx.arc(u, v, pr, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1.5, 2 * (this.uiScale || 1));
      ctx.stroke();

      // center dot
      ctx.beginPath();
      ctx.arc(u, v, Math.max(2.5, pr * 0.12), 0, Math.PI * 2);
      ctx.fillStyle = stroke;
      ctx.fill();

      // label// label
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "12px system-ui, -apple-system, 'Noto Sans KR', Segoe UI, Roboto, Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(z.id), u, v - (pr + 10));
    }

    // Patch 8-3A: markers (bots)
    if (this.markers && this.markers.length) {
      for (const m of this.markers) {
        const dx = m.x - this.player.x;
        const dz = m.z - this.player.z;
        if (!this._withinRange(dx, dz)) continue;
        const t = this._deltaToPixel(dx, dz);
        const u = t.cx + t.px;
        const v = t.cy + t.py;

        // bots: small team-colored dots
        const isRed = (m.team === "red" || m.team === "t" || m.team === "redteam");
        const col = isRed ? "rgba(255,77,77,0.95)" : "rgba(63,169,245,0.95)";

        const mr = Math.max(2.8, 3.2 * (this.uiScale || 1));
        ctx.beginPath();
        ctx.arc(u, v, mr, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
        // thin outline for contrast
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Player indicator (Patch 8-1G): stable dot (no rotation)
    // - Fill: white
    // - Stroke: team color
    ctx.save();
    ctx.translate(cx, cy);
    const uiS = Number.isFinite(this.uiScale) ? Number(this.uiScale) : 1;
    const r = this._clamp(4.5 * uiS, 3.5, 6.5);
    const stroke = this.player.team === "RED" ? "#FF4D4D" : "#3FA9F5";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    ctx.restore(); // clip

    // Outer border ring
    if (this.circular) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    }
  }
}