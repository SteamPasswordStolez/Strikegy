import type { Boundary } from '@/world/terrain';
import type { MapDef, MapObject } from '@/world/mapTypes';

/**
 * Top-down picture of a map (north up) for the deploy screen and minimap:
 * playable area, roads and pads, walls and cover, buildings. Painted once.
 */
export interface MapImage {
  canvas: HTMLCanvasElement;
  /** World (x, z) -> canvas pixels. */
  project(x: number, z: number): [number, number];
  /** Canvas pixels per meter. */
  scale: number;
}

const PAD = 24;

/** Only the outline's points are used (the lobby passes a plain outline, without the terrain module). */
export function paintMap(map: MapDef, boundary: Pick<Boundary, 'points'>, maxPx = 1400): MapImage {
  const xs = boundary.points.map((p) => p[0]);
  const zs = boundary.points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const scale = (maxPx - PAD * 2) / Math.max(maxX - minX, maxZ - minZ);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((maxX - minX) * scale + PAD * 2);
  canvas.height = Math.ceil((maxZ - minZ) * scale + PAD * 2);
  const project = (x: number, z: number): [number, number] => [(x - minX) * scale + PAD, (z - minZ) * scale + PAD];
  const g = canvas.getContext('2d')!;

  // Outside: dark forest. Inside: open ground.
  g.fillStyle = '#1e2620';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.beginPath();
  boundary.points.forEach(([x, z], i) => {
    const [u, v] = project(x, z);
    if (i === 0) g.moveTo(u, v);
    else g.lineTo(u, v);
  });
  g.closePath();
  g.fillStyle = '#4a4f43';
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = '#8c917e';
  g.stroke();
  g.save();
  g.clip();

  const rect = (o: MapObject, fill: string) => {
    const [u, v] = project(o.pos[0], o.pos[2]);
    const yaw = ((o.rot?.[1] ?? 0) * Math.PI) / 180;
    g.save();
    g.translate(u, v);
    // Map yaw rotates about +Y; on a north-up image that is a clockwise turn by -yaw.
    g.rotate(-yaw);
    g.fillStyle = fill;
    g.fillRect((-o.size[0] / 2) * scale, (-o.size[2] / 2) * scale, o.size[0] * scale, o.size[2] * scale);
    g.restore();
  };
  // Rivers under everything else, trees on top of the ground.
  for (const r of map.world.terrain?.rivers ?? []) {
    g.beginPath();
    r.pts.forEach(([x, z], i) => {
      const [u, v] = project(x, z);
      if (i === 0) g.moveTo(u, v);
      else g.lineTo(u, v);
    });
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#3f6275';
    g.lineWidth = Math.max(2, r.width * scale);
    g.stroke();
  }
  g.fillStyle = 'rgba(28, 48, 34, 0.75)';
  for (const [x, z, sc] of map.trees ?? []) {
    const [u, v] = project(x, z);
    g.beginPath();
    g.arc(u, v, Math.max(1, (1.6 + sc * 1.4) * scale), 0, Math.PI * 2);
    g.fill();
  }
  // Flat things first (roads, pads), then walls and cover on top.
  for (const o of map.objects) if (o.type === 'floor' && o.size[1] < 1.5) rect(o, o.color && isDark(o.color) ? '#353634' : '#5d5e57');
  for (const o of map.objects) if (o.type === 'wall' || (o.type === 'floor' && o.size[1] >= 1.5)) rect(o, '#9a9a8e');
  for (const o of map.objects) if (o.type === 'cover' || o.type === 'prop') rect(o, '#77776c');
  for (const b of map.buildings ?? []) {
    const [u, v] = project(b.pos[0], b.pos[1]);
    const yaw = ((b.rot ?? 0) * Math.PI) / 180;
    g.save();
    g.translate(u, v);
    g.rotate(-yaw);
    g.fillStyle = b.solid ? '#6f6a62' : '#9b907f';
    g.fillRect((-b.size[0] / 2) * scale, (-b.size[1] / 2) * scale, b.size[0] * scale, b.size[1] * scale);
    g.strokeStyle = '#2c2a26';
    g.lineWidth = 1;
    g.strokeRect((-b.size[0] / 2) * scale, (-b.size[1] / 2) * scale, b.size[0] * scale, b.size[1] * scale);
    g.restore();
  }
  g.restore();
  return { canvas, project, scale };
}

function isDark(hex: string): boolean {
  const n = parseInt(hex.replace('#', ''), 16);
  const l = ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11;
  return l < 110;
}
